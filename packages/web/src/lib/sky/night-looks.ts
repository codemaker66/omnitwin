// -----------------------------------------------------------------------------
// night-looks — how the Merchant City round the Grand Hall looks after dark
//
// At night the city's white card model turns a dark violet, its skyline
// brighter than its buildings so the blocks stand as silhouettes; amber pools
// of light lie along Glassford Street under the council's real lamps, a warm
// scallop on the wall under each, and a chain of lantern points fades into
// violet haze. The hall stays the brightest thing in view.
//
// Four looks, one constant: Evocative is shown. Every value is a shader
// uniform (hall-street-light.ts) or a sky keyframe (sky-palette.ts), so a look
// switches without recompiling anything. Colours are linear Rec.709 shader
// values, chosen through the planner's night grade (white balance
// [0.93, 1, 1.14], saturation 1.02, exposure 1.12, PBR Neutral, bloom
// threshold 0.92) to land on display targets read from the references
// (D:/claude/night-street-20261018/research-look/params.json, derived.json).
// "Light" values are what reaches a surface (its albedo multiplies them);
// window, lens and beam values are emitted light.
//
// The council specifies 3000 K warm white for its lamps. Half-adapted for
// night viewing that is linear (1, 0.70, 0.37), close to Evocative's pool core
// (1, 0.64, 0.30); the yellow lantern heads and crimson pool rims are art
// direction from the references. "True to street" shows plain 3000 K.
// "Off" is close to the city before the street lamps: its night sky, the old
// orange city glow and the old windows, for comparison at night. Its glow
// follows today's night span (−3° to −10°) where the old one ran −4° to −11°,
// so at dusk compare against the commit before the lamps itself.
//
// A development build honours `?street=subtle|evocative|noir|true|off`,
// as `?render=` overrides the render profile.
// -----------------------------------------------------------------------------

import type { Rgb } from "./sky-palette.js";

export type StreetNightLookName = "subtle" | "evocative" | "noir" | "true" | "off";

export const STREET_NIGHT_LOOK_NAMES: readonly StreetNightLookName[] = ["subtle", "evocative", "noir", "true", "off"];

/** The night sky at one sun altitude: sRGB hex, as the palette's keyframes. */
export interface NightSkyKey {
  readonly zenith: string;
  readonly horizonSun: string;
  readonly horizonAway: string;
}

export interface StreetNightLook {
  readonly name: StreetNightLookName;
  /**
   * The sky's keyframes at −12° and −18° of sun. Over a lit city the sky
   * levels off once nautical twilight ends (its own glow outshines what is
   * left of the sun's), so −18° is the look's night and −12° only a little
   * lighter (about 15%), never darker: dragging the dial on into the night
   * never brightens the sky.
   */
  readonly sky12: NightSkyKey;
  readonly sky18: NightSkyKey;
  /** Added to the dome at the horizon at night, fading upward (the city's glow). */
  readonly domeGlow: Rgb;
  /** The night haze's reach, metres. */
  readonly hazeReach: number;
  /**
   * Dusk, as the sun sinks from 1.5° to 4.5° below the horizon, before the
   * night's own light takes over (hall-street-light.ts, DUSK_SPAN): the
   * card's light from the sky falls to `wall` of the day's on its walls and
   * `roof` on its roofs and the ground, and the air between the blocks to
   * `air` of the horizon's colour, so the blocks stand darker than the
   * still-bright sky and the first pools read amber, not peach on lavender.
   * 1, 1, 1 keeps the day's light.
   */
  readonly dusk: { readonly wall: number; readonly roof: number; readonly air: number };
  /** Night light on the card, or null to keep the sky's own ambient (the look before the lamps). */
  readonly ambient: {
    /** Walls facing the night glow, and walls away from it. */
    readonly wallLit: Rgb;
    readonly wallShadow: Rgb;
    readonly roof: Rgb;
    readonly ground: Rgb;
  } | null;
  /** Whether the street lamps light at dusk. */
  readonly lamps: boolean;
  readonly pool: {
    /** The pool's radius across the street, metres (1.3× that along it). */
    readonly radius: number;
    readonly core: Rgb;
    readonly edge: Rgb;
    /** The last 8% of the pool tinted toward crimson: the edge × this (white for none). */
    readonly rim: Rgb;
    /** The pool edge's softness, in units of its radius: 0.08 is crisp. */
    readonly softness: number;
  };
  /**
   * Light on the wall under each lantern, at its brightest, and the distance
   * from the lantern at which it has fallen to half, metres.
   */
  readonly scallop: Rgb;
  readonly scallopReach: number;
  /**
   * The light's cone in the air: its colour at the lantern (zero for none)
   * and how far down it reaches, as a share of the mounting height.
   */
  readonly beam: { readonly color: Rgb; readonly reach: number };
  /** The lantern's lens, above the bloom's threshold (its core reads near white, warmed). */
  readonly lens: Rgb;
  /**
   * The halo round each lit lantern, at its brightest: below the bloom's
   * threshold (0.92), so it keeps its colour through the tone map and marks
   * the lantern when the frame-rate governor has given bloom up.
   */
  readonly halo: Rgb;
  readonly windows: {
    /** A lit window's light, on average. */
    readonly warm: Rgb;
    /** The share of windows lit far from the hall (110 m on), and within 30 m of it. */
    readonly share: number;
    readonly nearShare: number;
    /** Cool windows, as a share of lit ones (the look before the lamps had them). */
    readonly cool: Rgb;
    readonly coolShare: number;
    /** Neon accents in lit windows, each as a share of lit ones. */
    readonly magenta: Rgb;
    readonly magentaShare: number;
    readonly cyan: Rgb;
    readonly cyanShare: number;
    /** The lit pane in its cell, half-brightness bounds: across [lo, hi] and up [lo, hi]. */
    readonly pane: readonly [number, number, number, number];
    /** Each lit window's brightness: lowest and spread. */
    readonly brightness: readonly [number, number];
    /** Average light of windows too small to see, or null to work it out from the share and the pane. */
    readonly average: number | null;
  };
}

const WIDE_PANE = [0.3, 0.7, 0.28, 0.72] as const;
const NONE: Rgb = [0, 0, 0];
const WHITE: Rgb = [1, 1, 1];
const EVOCATIVE_SKY_12: NightSkyKey = { zenith: "#1d213a", horizonSun: "#353047", horizonAway: "#302e49" };
const EVOCATIVE_SKY_18: NightSkyKey = { zenith: "#1e1e2d", horizonSun: "#362b3b", horizonAway: "#33293b" };
// Walls darken most, so the blocks' sides stand against the sky; roofs and the
// ground less, so the massing still reads from above. Chosen from renders at
// 18:30 on 18 October (sun −3.65°): the street view's skyline 4.2× its blocks
// (1.7 before) and the hall's floor 1.9× the pools seen from the street side
// (0.95 before, the city outshining the hall); at half this darkening the hall
// stayed under 1.5×.
const EVOCATIVE_DUSK = { wall: 0.36, roof: 0.52, air: 0.62 } as const;
const EVOCATIVE_AMBIENT = {
  wallLit: [0.0335, 0.0216, 0.0489],
  wallShadow: [0.0129, 0.0111, 0.0182],
  roof: [0.0381, 0.0248, 0.0546],
  ground: [0.0329, 0.023, 0.0436],
} as const;

export const STREET_NIGHT_LOOKS: Readonly<Record<StreetNightLookName, StreetNightLook>> = {
  subtle: {
    name: "subtle",
    sky12: { zenith: "#151a30", horizonSun: "#2e2d42", horizonAway: "#2a2d45" },
    sky18: { zenith: "#181822", horizonSun: "#2d2936", horizonAway: "#2c2936" },
    domeGlow: [0.015, 0.003, 0.008],
    hazeReach: 200,
    dusk: { wall: 0.45, roof: 0.62, air: 0.72 },
    ambient: { wallLit: [0.03, 0.028, 0.045], wallShadow: [0.016, 0.016, 0.022], roof: [0.032, 0.029, 0.046], ground: [0.032, 0.031, 0.043] },
    lamps: true,
    // The derived core (display luminance 0.05) read as brown paint: a quieter amber, less saturated.
    pool: { radius: 5, core: [0.24, 0.135, 0.05], edge: [0.18, 0.085, 0.05], rim: WHITE, softness: 0.08 },
    scallop: [0.12, 0.07, 0.03],
    scallopReach: 3,
    beam: { color: NONE, reach: 0.7 },
    lens: [1.3, 0.9, 0.22],
    halo: [0.3, 0.16, 0.03],
    windows: {
      warm: [0.13, 0.075, 0.035], share: 0.14, nearShare: 0.04, cool: NONE, coolShare: 0,
      magenta: NONE, magentaShare: 0, cyan: NONE, cyanShare: 0, pane: WIDE_PANE, brightness: [0.55, 0.9], average: null,
    },
  },
  evocative: {
    name: "evocative",
    sky12: EVOCATIVE_SKY_12,
    sky18: EVOCATIVE_SKY_18,
    // Magenta along the skyline, lighter than the blocks below it from street level (display luminance about
    // 0.013 at 15° up, against 0.005 for a lit wall).
    domeGlow: [0.036, 0.007, 0.015],
    hazeReach: 160,
    dusk: EVOCATIVE_DUSK,
    ambient: EVOCATIVE_AMBIENT,
    lamps: true,
    // Sodium-amber cores (display luminance 0.08, hue 35°, so the hall's floor
    // stays half as bright again), orange toward the edge (hue 16°) and a
    // crimson rim: the edge × (1, 0.6, 1.25) lands at a display hue of 346°,
    // the references' 345–353°.
    pool: { radius: 6, core: [0.32, 0.155, 0.03], edge: [0.25, 0.088, 0.042], rim: [1, 0.6, 1.25], softness: 0.08 },
    // An orange wash (display hue 23°) fading by half 3.5 m from the lantern.
    scallop: [0.17, 0.085, 0.025],
    scallopReach: 3.5,
    // A cone of sodium light under each lantern, gone by 70% of the mounting height (the design's 0.020 display
    // luminance at the lantern could not be seen in any frame).
    beam: { color: [0.11, 0.068, 0.02], reach: 0.7 },
    // Sodium yellow: the core reads a warm yellow through the tone map (hue about 44°) rather than cream, and
    // the halo round it amber (about 39°).
    lens: [1.5, 1.0, 0.25],
    halo: [0.42, 0.22, 0.04],
    windows: {
      warm: [0.22, 0.115, 0.035], share: 0.22, nearShare: 0.04, cool: NONE, coolShare: 0,
      magenta: [0.1436, 0.0395, 0.1248], magentaShare: 0.04, cyan: [0.0582, 0.2981, 0.2844], cyanShare: 0.02,
      pane: WIDE_PANE, brightness: [0.55, 0.9], average: null,
    },
  },
  noir: {
    name: "noir",
    sky12: { zenith: "#1d1f3b", horizonSun: "#43344c", horizonAway: "#3d324d" },
    sky18: { zenith: "#1f1c31", horizonSun: "#472d3c", horizonAway: "#422c3c" },
    domeGlow: [0.046, 0.007, 0.019],
    hazeReach: 140,
    dusk: { wall: 0.3, roof: 0.45, air: 0.55 },
    ambient: { wallLit: [0.0415, 0.0138, 0.0405], wallShadow: [0.0082, 0.0056, 0.0082], roof: [0.047, 0.018, 0.049], ground: [0.045, 0.023, 0.04] },
    lamps: true,
    pool: { radius: 7, core: [0.46, 0.2, 0.035], edge: [0.36, 0.11, 0.05], rim: [1, 0.6, 1.25], softness: 0.08 },
    scallop: [0.24, 0.115, 0.03],
    scallopReach: 4,
    // 0.059 display luminance at the lantern, gone by 90% of the mounting height.
    beam: { color: [0.1141, 0.0756, 0.0319], reach: 0.9 },
    lens: [2.2, 1.35, 0.3],
    halo: [0.55, 0.26, 0.04],
    windows: {
      warm: [0.3, 0.13, 0.04], share: 0.3, nearShare: 0.04, cool: NONE, coolShare: 0,
      magenta: [0.261, 0.051, 0.221], magentaShare: 0.04, cyan: [0.065, 0.621, 0.584], cyanShare: 0.02,
      pane: WIDE_PANE, brightness: [0.55, 0.9], average: null,
    },
  },
  true: {
    name: "true",
    sky12: EVOCATIVE_SKY_12,
    sky18: EVOCATIVE_SKY_18,
    domeGlow: [0.036, 0.007, 0.015],
    hazeReach: 160,
    dusk: EVOCATIVE_DUSK,
    ambient: EVOCATIVE_AMBIENT,
    lamps: true,
    // 3000 K warm white, soft edged, no rim.
    pool: { radius: 6, core: [0.303, 0.212, 0.112], edge: [0.303, 0.212, 0.112], rim: WHITE, softness: 0.45 },
    // 3000 K at about Evocative's luminance.
    scallop: [0.135, 0.095, 0.05],
    scallopReach: 3.5,
    beam: { color: NONE, reach: 0.7 },
    lens: [2.0, 1.4, 0.74],
    halo: [0.42, 0.29, 0.15],
    windows: {
      warm: [0.22, 0.115, 0.035], share: 0.22, nearShare: 0.04, cool: NONE, coolShare: 0,
      magenta: NONE, magentaShare: 0, cyan: NONE, cyanShare: 0, pane: WIDE_PANE, brightness: [0.55, 0.9], average: null,
    },
  },
  off: {
    name: "off",
    sky12: { zenith: "#111b38", horizonSun: "#2e2f4b", horizonAway: "#1f2747" },
    sky18: { zenith: "#0a1125", horizonSun: "#1c2034", horizonAway: "#181e34" },
    domeGlow: [0.16, 0.085, 0.04],
    hazeReach: 100,
    dusk: { wall: 1, roof: 1, air: 1 },
    ambient: null,
    lamps: false,
    pool: { radius: 6, core: NONE, edge: NONE, rim: WHITE, softness: 0.08 },
    scallop: NONE,
    scallopReach: 3.5,
    beam: { color: NONE, reach: 0.7 },
    lens: NONE,
    halo: NONE,
    windows: {
      warm: [0.6, 0.396, 0.216], share: 0.14, nearShare: 0.14, cool: [0.48, 0.516, 0.6], coolShare: 0.14,
      magenta: NONE, magentaShare: 0, cyan: NONE, cyanShare: 0, pane: [0.4, 0.6, 0.37, 0.65], brightness: [0.35, 0.65],
      average: 0.012,
    },
  },
};

/** The look shown. */
export const STREET_NIGHT_LOOK: StreetNightLookName = "evocative";

function isLookName(value: string): value is StreetNightLookName {
  return (STREET_NIGHT_LOOK_NAMES as readonly string[]).includes(value);
}

/** The look for a page address: `?street=` in a development build, otherwise the one shown. */
export function resolveStreetNightLook(search: string, development: boolean): StreetNightLook {
  const asked = development ? new URLSearchParams(search).get("street") : null;
  return STREET_NIGHT_LOOKS[asked !== null && isLookName(asked) ? asked : STREET_NIGHT_LOOK];
}

let active: StreetNightLook | null = null;

/** The look this page shows, read once from its address. */
export function activeStreetNightLook(): StreetNightLook {
  if (active === null) {
    const search = typeof window === "undefined" ? "" : window.location.search;
    active = resolveStreetNightLook(search, import.meta.env.DEV);
  }
  return active;
}

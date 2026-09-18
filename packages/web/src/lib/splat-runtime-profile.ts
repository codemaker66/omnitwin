import type { DeviceTier } from "./device-tier.js";

// Device budgets are preserved from the measured Spark baseline. Native Three
// uses complete vendor capture levels (selected by roomLevelForBudget), not a
// Spark tree or arbitrary point removal. DPR and SH settings still apply.
// Native performance must be measured separately; the old measurements are
// recorded in docs/reports/splat-drag-budget-2026-09-03.md.

export interface SplatRuntimeSettings {
  /** Minimum gap between depth sorts. 0 sorts on every camera change. */
  readonly minSortIntervalMs: number;
  /** Standard deviations from a Gaussian's centre at which it stops drawing. */
  readonly maxStdDev: number;
  /** Whether staged scenes select complete capture levels within the device budget. */
  readonly lod: boolean;
  /**
   * Gaussians on screen while the view is still. At or above the room's leaf
   * count this is the complete reconstruction; the tree then costs nothing.
   */
  readonly lodSplatCount: number;
  /**
   * Gaussians on screen while the view is moving. This is the number that
   * sets the frame rate under a drag; the resting budget never does, because
   * a still view under the demand loop renders no frames at all.
   */
  readonly motionLodSplatCount: number;
  /** Highest spherical-harmonic degree evaluated per Gaussian, 0 to 3. */
  readonly maxSh: number;
  /** Legacy query field retained for compatibility; native delivery always uses source captures. */
  readonly preferTrees: boolean;
  /** Pixel ratio while the view is moving. */
  readonly motionDpr: number;
  /** Pixel ratio cap once the view is still (the device's own ratio if lower). */
  readonly settledDpr: number;
}

export interface SplatRuntimeProfile extends SplatRuntimeSettings {
  readonly tier: DeviceTier;
  /** "override" when at least one field came from the query string. */
  readonly source: "tier" | "override";
}

export interface SplatRuntimeOverrides extends Partial<SplatRuntimeSettings> {
  readonly tier?: DeviceTier;
}

/** Preserve the previous Gaussian tail cutoff while changing render backends. */
export const SPLAT_MAX_STD_DEV = Math.sqrt(8);

const TIERS: readonly DeviceTier[] = ["poster", "low", "medium", "high"];

/**
 * The largest settled drawing buffer worth asking a device for, in pixels.
 *
 * Four times a 1600x900 canvas, which is what a 1x laptop supersampled to 2
 * costs. Beyond it the gain is invisible and the memory is not: the Grand Hall
 * at 3200x1800 already holds 529 MB against 434 MB at 1600x900.
 */
const SETTLED_PIXEL_BUDGET = 8_300_000;

/**
 * The pixel ratio to rest at, given what the profile wants and how large the
 * canvas is.
 *
 * The display's own ratio is deliberately NOT a ceiling. A 1x laptop rendering
 * at 2 and presenting at 1 is supersampling, and on this room it is worth a
 * great deal: measured on the Grand Hall (2026-09-04) the name boards came out
 * 100% sharper by Laplacian variance, the panelling 75% and the frieze 48%,
 * with no cost to the frame rate under drag — the loop draws the settled frame
 * once and then sleeps, so the extra pixels are paid for at a standstill.
 *
 * What does bound it is memory, hence the budget: a 4K canvas already has more
 * pixels than the budget allows, so it renders at its own ratio and no more.
 */
export function settledPixelRatio(
  profileSettledDpr: number,
  cssWidth: number,
  cssHeight: number,
): number {
  const pixels = cssWidth * cssHeight;
  if (!Number.isFinite(pixels) || pixels <= 0) return 1;
  const affordable = Math.sqrt(SETTLED_PIXEL_BUDGET / pixels);
  return Math.max(1, Math.min(profileSettledDpr, affordable));
}

export const SPLAT_RUNTIME_PROFILES: Readonly<Record<DeviceTier, SplatRuntimeSettings>> = {
  poster: {
    // Extrapolated, not measured: software renderers should not be here at all.
    minSortIntervalMs: 0,
    maxStdDev: SPLAT_MAX_STD_DEV,
    lod: true,
    lodSplatCount: 600_000,
    motionLodSplatCount: 150_000,
    maxSh: 3,
    preferTrees: false,
    motionDpr: 1,
    settledDpr: 1,
  },
  low: {
    // Extrapolated, not measured: budget mobile GPUs.
    minSortIntervalMs: 0,
    maxStdDev: SPLAT_MAX_STD_DEV,
    lod: true,
    lodSplatCount: 1_500_000,
    motionLodSplatCount: 300_000,
    maxSh: 3,
    preferTrees: false,
    motionDpr: 1,
    settledDpr: 1.5,
  },
  medium: {
    // Extrapolated, not measured: integrated desktop and mid-range mobile GPUs.
    minSortIntervalMs: 0,
    maxStdDev: SPLAT_MAX_STD_DEV,
    lod: true,
    lodSplatCount: 3_000_000,
    motionLodSplatCount: 500_000,
    maxSh: 3,
    preferTrees: false,
    motionDpr: 1,
    settledDpr: 2,
  },
  high: {
    // Full source detail on high-tier devices; requalify against the native baseline.
    minSortIntervalMs: 0,
    maxStdDev: SPLAT_MAX_STD_DEV,
    lod: false,
    lodSplatCount: 8_000_000,
    motionLodSplatCount: 2_500_000,
    maxSh: 3,
    preferTrees: false,
    motionDpr: 1,
    settledDpr: 2,
  },
};

interface NumericRange {
  readonly min: number;
  readonly max: number;
  /** Whether zero is a legal value (a sort interval of 0 means every frame). */
  readonly allowZero: boolean;
  readonly integer: boolean;
}

const RANGES = {
  minSortIntervalMs: { min: 0, max: 1000, allowZero: true, integer: true },
  maxStdDev: { min: 1, max: 4, allowZero: false, integer: false },
  motionDpr: { min: 0.25, max: 3, allowZero: false, integer: false },
  settledDpr: { min: 0.25, max: 3, allowZero: false, integer: false },
  /** Retained budget range; actual native storage limits are checked per device. */
  lodSplatCount: { min: 65_536, max: 16_777_216, allowZero: false, integer: true },
  motionLodSplatCount: { min: 65_536, max: 16_777_216, allowZero: false, integer: true },
  maxSh: { min: 0, max: 3, allowZero: true, integer: true },
} as const satisfies Record<string, NumericRange>;

type NumericField = keyof typeof RANGES;

/** Parses a positive (or, where allowed, zero) finite number, clamped to its range. */
function parseClamped(raw: string, range: NumericRange): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (value < 0 || (value === 0 && !range.allowZero)) return null;
  const clamped = Math.min(range.max, Math.max(range.min, value));
  return range.integer ? Math.round(clamped) : clamped;
}

function isDeviceTier(value: string): value is DeviceTier {
  return (TIERS as readonly string[]).includes(value);
}

const NUMERIC_KEYS: Readonly<Record<string, NumericField>> = {
  sort: "minSortIntervalMs",
  std: "maxStdDev",
  dpr: "motionDpr",
  rest: "settledDpr",
  motion: "motionLodSplatCount",
  sh: "maxSh",
};

/**
 * Reads runtime overrides from a query string.
 *
 * The grammar is one parameter, `splat`, holding comma-separated `key:value`
 * pairs: `?splat=sort:50,std:2.236,dpr:0.5,rest:1.5,lod:1500000,motion:750000,sh:1,tier:medium`.
 * `lod` takes the resting budget, or `on` for the tier's budget, or `off`;
 * `motion` is the budget while the view moves; `sh` caps the harmonic degree;
 * `trees` is `on` or `off` for the prebuilt trees. Unknown keys
 * and malformed or out-of-domain values are ignored individually; a later
 * valid value for the same key wins. Numbers are clamped to sane ranges so a
 * typo cannot allocate sixteen gigabytes of paged splats.
 */
export function parseSplatOverrides(search: string): SplatRuntimeOverrides {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const spec = new URLSearchParams(query).get("splat");
  if (spec === null || spec.trim() === "") return {};

  const overrides: {
    -readonly [K in keyof SplatRuntimeOverrides]: SplatRuntimeOverrides[K];
  } = {};

  for (const pair of spec.split(",")) {
    const separator = pair.indexOf(":");
    if (separator <= 0) continue;
    const key = pair.slice(0, separator).trim().toLowerCase();
    const raw = pair.slice(separator + 1).trim();
    if (raw === "") continue;

    if (key === "tier") {
      if (isDeviceTier(raw)) overrides.tier = raw;
      continue;
    }
    if (key === "trees") {
      if (raw === "on") overrides.preferTrees = true;
      else if (raw === "off") overrides.preferTrees = false;
      continue;
    }
    if (key === "lod") {
      if (raw === "on") {
        overrides.lod = true;
      } else if (raw === "off") {
        overrides.lod = false;
      } else {
        const budget = parseClamped(raw, RANGES.lodSplatCount);
        if (budget !== null) {
          overrides.lod = true;
          overrides.lodSplatCount = budget;
        }
      }
      continue;
    }
    const field = NUMERIC_KEYS[key];
    if (field === undefined) continue;
    const value = parseClamped(raw, RANGES[field]);
    if (value !== null) overrides[field] = value;
  }

  return overrides;
}

/**
 * The settings a device should run with.
 *
 * `allowOverrides` gates the query string entirely: production callers pass
 * false (or nothing) and get the tier table; the DEV hook passes true so the
 * drag budget can sweep. A `tier` override re-tiers first, and the remaining
 * fields apply on top of that tier. Two invariants hold whatever the query
 * says, because breaking either would drop detail exactly when the view comes
 * to rest, which is the one thing a viewer notices: the settled ratio never
 * falls below the motion ratio, and the motion budget never exceeds the
 * resting budget.
 */
export function resolveSplatRuntimeProfile(
  tier: DeviceTier,
  search = "",
  allowOverrides = false,
): SplatRuntimeProfile {
  const overrides = allowOverrides ? parseSplatOverrides(search) : {};
  const { tier: tierOverride, ...settings } = overrides;
  const effectiveTier = tierOverride ?? tier;
  const merged: SplatRuntimeSettings = { ...SPLAT_RUNTIME_PROFILES[effectiveTier], ...settings };
  const overridden = Object.keys(overrides).length > 0;
  return {
    ...merged,
    settledDpr: Math.max(merged.settledDpr, merged.motionDpr),
    motionLodSplatCount: Math.min(merged.motionLodSplatCount, merged.lodSplatCount),
    tier: effectiveTier,
    source: overridden ? "override" : "tier",
  };
}

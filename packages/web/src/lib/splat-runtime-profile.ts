import type { DeviceTier } from "./device-tier.js";

// ---------------------------------------------------------------------------
// How hard the splat renderer may work on this device.
//
// Spark's per-frame cost has two independent halves. The SORT reads every
// Gaussian's depth back from the GPU and orders it in a worker; its cost is a
// function of splat count alone, and `minSortIntervalMs` is the only knob that
// changes how often it runs. The RASTER blends every visible Gaussian into
// every pixel; its cost scales with the pixel ratio and with `maxStdDev`, the
// radius at which a Gaussian's tail is cut. The level-of-detail tree caps the
// number of Gaussians that reach either half at a per-device budget.
//
// This module is the single place those numbers live. The table is per tier;
// the overrides exist so the drag budget script (scripts/splat-drag-budget.mjs)
// can sweep the space on a real GPU without a source edit per point, and they
// are only honoured where the caller says so (the hook passes DEV).
//
// The table's numbers are not opinions. They are set by measurement on the
// Grand Hall leaf set and recorded in docs/reports; a change here without a
// new measurement is a regression waiting to be discovered by a visitor.
// ---------------------------------------------------------------------------

export interface SplatRuntimeSettings {
  /** Minimum gap between depth sorts. 0 sorts on every camera change. */
  readonly minSortIntervalMs: number;
  /** Standard deviations from a Gaussian's centre at which it stops drawing. */
  readonly maxStdDev: number;
  /** Whether meshes load through Spark's level-of-detail tree. */
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
  /**
   * When the tree is on and a tile has a prebuilt tree, load that (paged)
   * instead of the tile. A prebuilt tree spares the browser the build but
   * costs about 3.4 times the tile's bytes on the wire, so this is a
   * bandwidth decision, not a quality one.
   */
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

/** Spark's own default: Gaussians draw out to sqrt(8) standard deviations. */
export const SPARK_DEFAULT_MAX_STD_DEV = Math.sqrt(8);

const TIERS: readonly DeviceTier[] = ["poster", "low", "medium", "high"];

/**
 * Per-tier settings, set by measurement on 2026-09-03
 * (docs/reports/splat-drag-budget-2026-09-03.md, scripts/splat-drag-budget.mjs).
 *
 * The Grand Hall leaf set (6.02 M Gaussians, twelve tiles) under a four-second
 * drag on an RTX 4090 laptop through WebGL2 ran at 13 to 15 fps whatever the
 * sort interval (33 to 100 ms), the motion pixel ratio (0.5) or the tail
 * radius (sqrt 5): the frame was twelve renderer hosts, one per tile, each
 * sorting, reading back and uploading the whole room. With ONE host the same
 * six million draw at 176 fps (p95 12.4 ms, heap 434 MB against 1.5 GB), and
 * with the level-of-detail tree the drag sits at the display's refresh
 * ceiling (239 fps) at any motion budget from 1.0 M to 2.5 M. The tree's
 * budgets measured with twelve hosts still order the devices (35.6 fps at
 * 2.5 M, 56.8 at 1.5 M, 75.7 at 1.0 M, 125 at 0.5 M), so they remain the
 * shape of the protection for weaker GPUs. The sort interval and the tail
 * radius stay at Spark's defaults because they measured as nothing.
 *
 * The tree is not free, and the measurements say where it pays. Built in the
 * browser it costs about twelve seconds of load on this room; prebuilt and
 * paged it loads in two seconds but fetches 348 MB where the tiles are 102,
 * because a complete resting view needs every leaf and the tree format is
 * 3.5 times the tile's bytes (the compact encoding changes nothing). So the
 * high tier, which needs no protection on the measured GPU, runs the tiles
 * as they are; the three weaker tiers build the tree in the browser, which
 * keeps the wire at the tiles' bytes; and the prebuilt trees stay in the
 * manifest as an opt-in (`trees:on`) for fast connections and for the
 * harness. The cheaper protection for weak devices is the vendor's own
 * coarser levels, which the staged bundle already holds: the next slice.
 *
 * Only the high tier was measured. The other three are scaled from it by
 * the usual gap between GPU classes and are marked so; each is replaced by
 * its own measurement the first time the drag budget runs on such a device.
 */
export const SPLAT_RUNTIME_PROFILES: Readonly<Record<DeviceTier, SplatRuntimeSettings>> = {
  poster: {
    // Extrapolated, not measured: software renderers should not be here at all.
    minSortIntervalMs: 0,
    maxStdDev: SPARK_DEFAULT_MAX_STD_DEV,
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
    maxStdDev: SPARK_DEFAULT_MAX_STD_DEV,
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
    maxStdDev: SPARK_DEFAULT_MAX_STD_DEV,
    lod: true,
    lodSplatCount: 3_000_000,
    motionLodSplatCount: 500_000,
    maxSh: 3,
    preferTrees: false,
    motionDpr: 1,
    settledDpr: 2,
  },
  high: {
    // Measured (RTX 4090 laptop, 1600x900, one host): the full 6.0 M without
    // the tree drags at 176 fps (p95 12.4 ms, heap 434 MB, 4.4 s load), so
    // this tier runs the tiles as they are; the tree would cost twelve
    // seconds of load for a frame rate already far past the display. The
    // budgets are kept for the day a device in this tier measures otherwise:
    // 2.5 M is Spark's own desktop default.
    minSortIntervalMs: 0,
    maxStdDev: SPARK_DEFAULT_MAX_STD_DEV,
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
  /** Spark's paged allocation ceiling: 256 pages of 65,536. */
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

import type { CoverageCollection } from "./bpf-schemas.js";

// ---------------------------------------------------------------------------
// One parameter's time series out of a CoverageJSON CoverageCollection
// (T-647), and the time step that stands for an instant.
//
// A range is an NdArray flattened in `axisNames` order (row-major: the last
// axis varies fastest). Besides `t`, a coverage can carry the site axes
// (x, y, z, locationId: one value each, as the guide documents for a point
// series) and one extra axis: percentiles in the percentile collection,
// thresholds in the probability collection. The caller says which index of
// an extra axis it wants; an axis it cannot choose from is a problem, never
// a guess.
// ---------------------------------------------------------------------------

export interface Series {
  /** Epoch milliseconds, strictly ascending. */
  readonly times: readonly number[];
  /** [start, end] per time for period parameters, else null. */
  readonly bounds: readonly (readonly [number, number])[] | null;
  readonly values: readonly (number | null)[];
}

export type AxisValue = string | number;
export type AxisSelector = (axisName: string, values: readonly AxisValue[] | null, length: number) => number | null;

export type SeriesRead =
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly problem: string }
  | { readonly status: "ok"; readonly series: Series };

const SITE_AXES = new Set(["x", "y", "z", "locationId"]);

function siteAxisIndex(name: string, length: number): number | null | undefined {
  if (!SITE_AXES.has(name)) return undefined;
  return length === 1 ? 0 : null;
}

/** A threshold or percentile label as a number: 50, "50", ">=2.78e-08",
 *  "<1000.0". Null for anything else. */
export function axisNumber(value: AxisValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = /^\s*(?:>=|<=|>|<)?\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$/u.exec(value);
  if (match === null) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Picks the 50th percentile (the Met Office's own recommendation for a
 *  deterministic value from BPF), or the only value of a categorical
 *  parameter that has no percentile axis. */
export const medianSelector: AxisSelector = (name, values, length) => {
  const site = siteAxisIndex(name, length);
  if (site !== undefined) return site;
  if (values === null) return null;
  const index = values.findIndex((value) => axisNumber(value) === 50);
  return index >= 0 ? index : null;
};

/** Picks the threshold equal to `target` (in the threshold's own units)
 *  within a relative tolerance. */
export function thresholdSelector(target: number, relativeTolerance = 0.02): AxisSelector {
  return (name, values, length) => {
    const site = siteAxisIndex(name, length);
    if (site !== undefined) return site;
    if (values === null) return null;
    const index = values.findIndex((value) => {
      const threshold = axisNumber(value);
      return threshold !== null && Math.abs(threshold - target) <= Math.abs(target) * relativeTolerance;
    });
    return index >= 0 ? index : null;
  };
}

function parseInstant(value: AxisValue): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readSeries(collection: CoverageCollection, key: string, select: AxisSelector): SeriesRead {
  const coverage = collection.coverages.find((candidate) => Object.hasOwn(candidate.ranges, key));
  const range = coverage?.ranges[key];
  if (coverage === undefined || range === undefined) return { status: "absent" };

  const tAxis = range.axisNames.indexOf("t");
  if (tAxis < 0) return { status: "invalid", problem: `${key}: no t axis` };
  const tDomain = coverage.domain.axes["t"];
  const tLength = range.shape[tAxis] ?? 0;
  if (tDomain?.values === undefined || tDomain.values.length !== tLength) {
    return { status: "invalid", problem: `${key}: t values do not match the range shape` };
  }
  const times: number[] = [];
  for (const value of tDomain.values) {
    const instant = parseInstant(value);
    if (instant === null) return { status: "invalid", problem: `${key}: a t value is not a date-time` };
    if (times.length > 0 && instant <= (times.at(-1) ?? Number.NEGATIVE_INFINITY)) {
      return { status: "invalid", problem: `${key}: t values are not strictly ascending` };
    }
    times.push(instant);
  }

  let bounds: [number, number][] | null = null;
  if (tDomain.bounds !== undefined) {
    if (tDomain.bounds.length !== 2 * times.length) {
      return { status: "invalid", problem: `${key}: t bounds are not two per time` };
    }
    bounds = [];
    for (let i = 0; i < times.length; i += 1) {
      const lower = parseInstant(tDomain.bounds[2 * i] ?? "");
      const upper = parseInstant(tDomain.bounds[2 * i + 1] ?? "");
      if (lower === null || upper === null || lower >= upper) {
        return { status: "invalid", problem: `${key}: a t bound pair is not an interval` };
      }
      bounds.push([lower, upper]);
    }
  }

  const strides = new Array<number>(range.shape.length).fill(1);
  for (let i = range.shape.length - 2; i >= 0; i -= 1) {
    strides[i] = (strides[i + 1] ?? 1) * (range.shape[i + 1] ?? 1);
  }
  let base = 0;
  for (let i = 0; i < range.axisNames.length; i += 1) {
    if (i === tAxis) continue;
    const name = range.axisNames[i] ?? "";
    const length = range.shape[i] ?? 0;
    const axisValues = coverage.domain.axes[name]?.values ?? null;
    if (axisValues !== null && axisValues.length !== length) {
      return { status: "invalid", problem: `${key}: axis ${name} does not match the range shape` };
    }
    const index = select(name, axisValues, length);
    if (index === null || index < 0 || index >= length) {
      return { status: "invalid", problem: `${key}: no usable value on axis ${name}` };
    }
    base += index * (strides[i] ?? 1);
  }
  const tStride = strides[tAxis] ?? 1;
  const values = times.map((_, k) => range.values[base + k * tStride] ?? null);
  return { status: "ok", series: { times, bounds, values } };
}

export interface Step {
  readonly index: number;
  readonly validFrom: number;
  readonly validTo: number;
}

const ONE_HOUR_MS = 3_600_000;

/** The time step that stands for `at`: each step covers from the midpoint
 *  with the previous step to the midpoint with the next (half its own
 *  spacing at either end). */
export function locateStep(times: readonly number[], at: number): Step | "before" | "after" {
  const n = times.length;
  if (n === 0) return "after";
  for (let i = 0; i < n; i += 1) {
    const t = times[i] ?? 0;
    const previous = i > 0 ? t - (times[i - 1] ?? t) : null;
    const next = i < n - 1 ? (times[i + 1] ?? t) - t : null;
    const halfBefore = (previous ?? next ?? ONE_HOUR_MS) / 2;
    const halfAfter = (next ?? previous ?? ONE_HOUR_MS) / 2;
    const validFrom = t - halfBefore;
    const validTo = t + halfAfter;
    if (i === 0 && at < validFrom) return "before";
    if (at >= validFrom && (at < validTo || (i === n - 1 && at === validTo))) {
      return { index: i, validFrom, validTo };
    }
  }
  return "after";
}

/** The series value standing for `at`, or undefined when no step covers it.
 *  A period parameter uses the period that contains `at`. */
export function valueAt(series: Series, at: number): number | null | undefined {
  if (series.bounds !== null) {
    const index = series.bounds.findIndex(([lower, upper]) => lower <= at && at < upper);
    return index < 0 ? undefined : series.values[index] ?? null;
  }
  const step = locateStep(series.times, at);
  return typeof step === "string" ? undefined : series.values[step.index] ?? null;
}

/** The [start, end] of the period containing `at`, for period parameters. */
export function periodAt(series: Series, at: number): readonly [number, number] | null {
  if (series.bounds === null) return null;
  return series.bounds.find(([lower, upper]) => lower <= at && at < upper) ?? null;
}

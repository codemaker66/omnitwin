// -----------------------------------------------------------------------------
// frame-geometry — the pure drawing behind the document frame.
//
// A prospect map's border was ruled by a hand, and a hand wavers by a hair
// over a foot of paper; a CSS border is dead straight and reads as a
// template in the first second. So the border is an SVG path with a small,
// deterministic deviation along each edge, zero at the corners so they stay
// crisp. Deterministic means a hash, never Math.random: the fairness lint
// sees this directory, and a border that differs per reader is a border
// nobody can proof.
// -----------------------------------------------------------------------------
import type { QUARTER_DAYS } from "./stage-manifest.js";

export type QuarterDay = (typeof QUARTER_DAYS)[number];

/** The quarter days as a cartouche would print them. */
export const QUARTER_DAY_LABELS: Readonly<Record<QuarterDay, string>> = {
  lammas: "Lammas",
  michaelmas: "Michaelmas",
  hallowmas: "Hallowmas",
  yule: "Yule",
  candlemas: "Candlemas",
  thaw: "The Thaw",
  beltane: "Beltane",
  midsummer: "Midsummer",
};

export function quarterDayLabel(day: QuarterDay): string {
  return QUARTER_DAY_LABELS[day];
}

/**
 * A stable 0..1 value per index and seed: the shader hash everyone uses,
 * chosen because it needs no table and repeats exactly for the same inputs.
 */
export function handNoise(index: number, seed: number): number {
  const raw = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

export interface RuledBorderOptions {
  /** Distance from the viewBox edge, in viewBox units. */
  readonly inset: number;
  /** Peak deviation from a straight line, in viewBox units. */
  readonly amplitude: number;
  /** Distance between samples along an edge, in viewBox units. */
  readonly step: number;
  readonly seed: number;
  /** The square viewBox's side; the path is meant for preserveAspectRatio="none". */
  readonly size?: number;
}

/**
 * A closed path around the inset rectangle with a hand's waver along each
 * edge. The waver is enveloped by sin(πt) along the edge so every corner
 * lands exactly on the rectangle.
 */
export function ruledBorderPath(options: RuledBorderOptions): string {
  const size = options.size ?? 1000;
  const { inset, amplitude, step, seed } = options;
  const near = inset;
  const far = size - inset;
  const span = far - near;
  const samples = Math.max(2, Math.round(span / step));
  const points: string[] = [];
  let sampleIndex = 0;

  const along = (from: number, to: number, fixed: number, horizontal: boolean, edgeSeed: number): void => {
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const envelope = Math.sin(Math.PI * t);
      const deviation = (handNoise(sampleIndex, seed + edgeSeed) * 2 - 1) * amplitude * envelope;
      sampleIndex += 1;
      const position = from + (to - from) * t;
      const x = horizontal ? position : fixed + deviation;
      const y = horizontal ? fixed + deviation : position;
      points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  };

  along(near, far, near, true, 1);   // top, left to right
  along(near, far, far, false, 2);   // right, top to bottom
  along(far, near, far, true, 3);    // bottom, right to left
  along(far, near, near, false, 4);  // left, bottom to top

  const [first, ...rest] = points;
  if (first === undefined) return "";
  return `M ${first} ${rest.map((point) => `L ${point}`).join(" ")} Z`;
}

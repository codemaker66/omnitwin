// ---------------------------------------------------------------------------
// money — exact currency arithmetic in integer minor units (pence).
//
// Money is NEVER represented as a floating-point major-unit number internally:
// 0.1 + 0.2 ≠ 0.3 in IEEE-754, and "× 100 / 100" rounding loses pennies under
// accumulation. Every amount here is an integer count of minor units (pence for
// GBP), so addition and integer scaling are exact, and the only place rounding
// happens is one explicit, documented step with a chosen rounding mode.
//
// The centrepiece is `allocateMinor` — largest-remainder apportionment — which
// splits a total across weighted parts so the parts sum to the total EXACTLY,
// with no penny created or destroyed. That invariant (Σ parts ≡ total) is the
// thing floating-point money silently violates (e.g. £100 split three ways).
//
// Pure, deterministic, dependency-free. All amounts are assumed to sit within
// Number.MAX_SAFE_INTEGER, which holds for any realistic venue quote.
// ---------------------------------------------------------------------------

/** An integer count of minor units (e.g. pence). Exact under +, −, × integer. */
export type Minor = number;

/**
 * Rounding mode applied when a computation produces a fractional minor unit.
 * `half-even` (banker's rounding) is the default: it rounds ties to the nearest
 * even unit, which removes the upward bias of always rounding halves up and is
 * the convention used by most financial libraries and IEEE-754 itself.
 */
export type RoundingMode = "half-even" | "half-up" | "half-down" | "ceil" | "floor";

/** Round a real number to an integer under the given mode. Total function. */
export function roundToInt(value: number, mode: RoundingMode = "half-even"): number {
  if (!Number.isFinite(value)) return 0;
  const floor = Math.floor(value);
  const frac = value - floor;

  if (frac === 0) return floor;
  switch (mode) {
    case "floor":
      return floor;
    case "ceil":
      return floor + 1;
    case "half-up":
      return frac >= 0.5 ? floor + 1 : floor;
    case "half-down":
      return frac > 0.5 ? floor + 1 : floor;
    case "half-even":
      if (frac < 0.5) return floor;
      if (frac > 0.5) return floor + 1;
      return floor % 2 === 0 ? floor : floor + 1; // tie → nearest even
  }
}

/** Convert a major-unit amount (e.g. £12.50) to exact minor units (1250). */
export function poundsToMinor(major: number, mode: RoundingMode = "half-even"): Minor {
  // major may be a float from the DB; one rounding step pins it to whole pence.
  return roundToInt(major * 100, mode);
}

/** Convert minor units back to a major-unit number for display/serialisation. */
export function minorToMajor(minor: Minor): number {
  return minor / 100;
}

/** Multiply by an integer quantity — exact, no rounding. Throws on non-integers
 *  so a fractional quantity can't silently lose precision; use `scaleMinor`. */
export function multiplyMinor(minor: Minor, quantity: number): Minor {
  if (!Number.isInteger(quantity)) {
    throw new RangeError(`multiplyMinor requires an integer quantity, got ${String(quantity)}`);
  }
  return minor * quantity;
}

/** Scale by an arbitrary real factor (rate, fractional hours), rounding once. */
export function scaleMinor(minor: Minor, factor: number, mode: RoundingMode = "half-even"): Minor {
  return roundToInt(minor * factor, mode);
}

/** Exact sum of minor amounts. */
export function sumMinor(values: readonly Minor[]): Minor {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Largest-remainder apportionment. Split `total` minor units across parts
 * proportional to `weights`, so the returned parts sum to `total` EXACTLY.
 *
 * Each part gets the floor of its ideal share; the leftover units (at most
 * n − 1 of them) are handed out one each to the parts with the largest
 * fractional remainders, ties broken by original index for determinism.
 *
 * Preconditions: `total` ≥ 0, weights non-negative and not all zero. With
 * all-zero weights it would divide by zero, so that is treated as an even split.
 */
export function allocateMinor(total: Minor, weights: readonly number[]): Minor[] {
  const n = weights.length;
  if (n === 0) return [];
  const totalWeight = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (totalWeight <= 0) return splitEvenly(total, n);

  const ideal = weights.map((w) => (total * Math.max(0, w)) / totalWeight);
  const floors = ideal.map((x) => Math.floor(x));
  const allocated = floors.reduce((sum, x) => sum + x, 0);
  let remainder = total - allocated; // whole units still to distribute

  // Distribute the remaining units to the largest fractional remainders.
  const order = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const parts = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k += 1) {
    const entry = order[k];
    if (entry === undefined) continue;
    parts[entry.i] = (parts[entry.i] ?? 0) + 1;
    remainder -= 1;
  }
  return parts;
}

/** Even split of `total` into `n` parts that sum to `total` exactly (the first
 *  `total mod n` parts get one extra unit). */
export function splitEvenly(total: Minor, n: number): Minor[] {
  if (n <= 0) return [];
  const base = Math.trunc(total / n);
  let remainder = total - base * n;
  const parts: Minor[] = [];
  for (let i = 0; i < n; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    parts.push(base + extra);
  }
  return parts;
}

/**
 * Split a total into a deposit and a balance. The deposit is `total × rate`
 * rounded to whole minor units; the balance is the exact remainder, so
 * deposit + balance ≡ total with no independent rounding of the balance.
 */
export function depositSplit(
  total: Minor,
  rate: number,
  mode: RoundingMode = "half-even",
): { readonly deposit: Minor; readonly balance: Minor } {
  const clamped = Math.max(0, Math.min(1, rate));
  const deposit = scaleMinor(total, clamped, mode);
  return { deposit, balance: total - deposit };
}

/** Format minor units as a localised currency string (e.g. "£1,234.56"). */
export function formatMinor(minor: Minor, currency = "GBP", locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minorToMajor(minor));
}

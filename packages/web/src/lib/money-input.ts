// ---------------------------------------------------------------------------
// Exact money input parsing — pounds string → integer minor units.
//
// The money discipline (api services/money.ts, T-427 schema layer) is that
// amounts are NEVER floating-point. parseFloat("0.29") * 100 === 28.999…;
// this module never multiplies decimals — it splits the string and does
// integer arithmetic only.
// ---------------------------------------------------------------------------

const POUNDS_INPUT_PATTERN = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/**
 * Parses a staff-entered pounds amount ("12", "12.5", "£12.50") into integer
 * pence. Returns null for anything ambiguous: empty input, negative values,
 * more than 2 decimal places, thousands separators, or non-numeric text.
 */
export function parsePoundsToMinor(input: string): number | null {
  const trimmed = input.trim().replace(/^£/, "");
  const match = POUNDS_INPUT_PATTERN.exec(trimmed);
  if (match === null) return null;
  const pounds = Number(match[1]);
  const penceDigits = match[2] ?? "";
  const pence = penceDigits.length === 0 ? 0 : Number(penceDigits.padEnd(2, "0"));
  return pounds * 100 + pence;
}

/** Formats integer minor units for display ("£12.50"). Display only — the
 *  formatted string is never parsed back. */
export function formatMinorAsCurrency(minor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

// ---------------------------------------------------------------------------
// A calendar date written as text.
//
// This module imports nothing, on purpose. The public enquiry schema checks
// its event date with it, and the walkthrough's and the front door's bundles
// carry that schema together with every module it imports
// (__tests__/enquiry-module-imports.test.ts).
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** A real calendar date written YYYY-MM-DD. */
export function isCalendarDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

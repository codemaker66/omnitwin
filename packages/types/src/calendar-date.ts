// ---------------------------------------------------------------------------
// A calendar date written as text.
//
// This module imports nothing, on purpose. The public enquiry schema checks
// its event date with it, and the walkthrough's and the front door's bundles
// carry that schema together with every module it imports
// (__tests__/enquiry-module-imports.test.ts).
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * A real calendar date written YYYY-MM-DD, from year 0001: every date a
 * PostgreSQL date column stores in that form. The year is set with
 * setUTCFullYear, never Date.UTC, which reads a year from 0 to 99 as 1900 to
 * 1999 and so would refuse "0027-06-12", the date a two-digit year typed in a
 * desktop date input posts (review of #404, P1).
 */
export function isCalendarDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// -----------------------------------------------------------------------------
// The guest's own calendar day, for the public enquiry forms' date fields.
//
// Blake, 13 November 2026: the three forms refuse an event date before today.
// "Today" is the day on the guest's own calendar, the browser's local date,
// never the UTC date toISOString gives: that is already tomorrow for a guest
// west of Greenwich in the evening, whose own today would then be refused.
// It is read each time a form is checked, never once when the page loaded,
// so a form left open past midnight takes the new day.
//
// This module imports nothing: the walkthrough's bundle carries it.
// -----------------------------------------------------------------------------

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today on the guest's own calendar, YYYY-MM-DD, as a date input writes it. */
export function guestToday(): string {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}
